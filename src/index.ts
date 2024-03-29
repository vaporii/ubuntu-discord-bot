import Docker from "dockerode";
import dotenv from "dotenv";
import { Client, Emoji, Intents, Message } from "discord.js";
import { convert } from "html-to-text";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";

dotenv.config();

const options = {
  rows: 20,
  cols: 40,
  channelIds: process.env.CHANNELS?.split(" ") || [],
  prefix: "u!",
  authorId: process.env.AUTHOR,
};

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.MESSAGE_CONTENT,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
  ],
});

function checkCommand(prefix: string, message: string) {
  if (!message.startsWith(prefix)) return;
  console.log(message.substring(prefix.length));
  return message.substring(prefix.length);
}

function getContainerByName(
  name: string
): Promise<Docker.ContainerInfo | undefined> {
  // filter by name
  var opts = {
    limit: 1,
    filters: `{"name": ["${name}"]}`,
  };

  return new Promise((resolve, reject) => {
    docker.listContainers(opts, function (err, containers) {
      if (err) {
        reject(err);
      } else {
        resolve(containers && containers[0]);
      }
    });
  });
}

function sendMessage(channelId: string, message: string) {
  const channel = client.channels.cache.get(channelId);
  if (
    channel?.type === "GUILD_TEXT" ||
    channel?.type === "GUILD_PUBLIC_THREAD" ||
    channel?.type === "GUILD_PRIVATE_THREAD"
  ) {
    return channel.send(message);
  }

  throw new Error("Not a text channel");
}

async function createContainer(channelId: string) {
  console.log("Creating container", channelId + "...");
  try {
    const container = await docker.createContainer({
      Image: "ubuntu-discord",
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: ["/bin/bash"],
      OpenStdin: true,
      StdinOnce: false,
      name: channelId,
      Hostname: "ubuntu-discord",
    });
    console.log("Created container");
    return container;
  } catch {
    throw new Error(
      "Image does not exist, maybe you didn't build the Dockerfile?"
    );
  }
}

function startShell(channelId: string, forceStart: boolean = false) {
  return new Promise(async (res, rej) => {
    const channel = await client.channels.fetch(channelId);

    if (!channel) {
      console.log("Failed to load channel", channelId);

      rej("Failed to load channel" + channelId);
    }

    console.log("Starting shell", channelId + "...");

    const terminal = new Terminal({ cols: options.cols, rows: options.rows });
    const serialize = new SerializeAddon();
    terminal.loadAddon(serialize);

    let container: Docker.Container;

    const result = await getContainerByName(channelId);

    if (result) {
      console.log("Container already exists");
      container = docker.getContainer(result.Id);
      if (result.State !== "running" || forceStart) {
        forceStart && console.log("Force starting container...");
        console.log("Container not running, attempting to start...");
        try {
          await container.start();
          console.log("Started container");
        } catch {
          console.log("Failed to start, removing...");
          await container.remove();
          console.log("Removed container, creating again...");
          container = await createContainer(channelId);
          console.log("Created container, starting...");
          await container.start().catch((err) => {
            throw new Error("Likely an error with image " + err);
          });
        }
      }
    } else {
      console.log("Creating container...");
      container = await createContainer(channelId);

      console.log("Created container, starting...");
      await container.start();
      console.log("Started");
    }

    await container.resize({ h: options.rows, w: options.cols });

    console.log("Attaching to container...");
    container.attach(
      { stream: true, stdin: true, stdout: true, stderr: true },
      (err, stream) => {
        if (err) return console.error(err);

        console.log("Attached to container");

        let streamEnded = false;

        stream?.setEncoding("utf-8");
        stream?.write("clear\n");

        stream?.on("data", (data) => {
          terminal.write(data);
        });

        stream?.on("end", () => {
          console.log("Stream", channelId + " ended");
          streamEnded = true;

          sendMessage(
            channelId,
            `**Ubuntu BASH shell stream Ended.**\nTo attempt restarting the shell, use ${options.prefix}attach.`
          );

          firstMessage?.delete();

          console.log("Shell", channelId, "ended");
        });

        let firstMessage: Message | undefined = undefined;
        let output = "";
        let lastOutput = "";

        async function sendContent() {
          if (streamEnded) return;
          const html = serialize.serializeAsHTML({
            includeGlobalBackground: true,
            scrollback: 0,
          });

          output =
            "## Ubuntu BASH Shell\n**Reactions:**\n" +
            "^C, ^X, Escape, Arrow keys, Backspace, Return/Enter, STOP\n*sudo password is 'password'*" +
            "```bash\n" +
            (convert(html).trim().replaceAll("`", "\\`") + " ```").slice(-1850);

          // If this isn't the first message, then edit it. If it is the first message, send blah blah and do reactions blah
          if (firstMessage) {
            if (output !== lastOutput) {
              firstMessage.edit(output);
            }

            lastOutput = output;
            return;
          }

          // initialize the message and add reactions and listeners and whatever
          sendMessage(channelId, output).then(async (message) => {
            // ◀️ 🔼 🔽 ▶️ ⬅️
            try {
              firstMessage = message;

              await message.react("🇨"); // ^C
              await message.react("🇽");
              await message.react("<:escape:1222383765628915784>"); // Escape
              await message.react("◀️");
              await message.react("🔼");
              await message.react("🔽");
              await message.react("▶️");
              await message.react("⬅️");
              await message.react("↩️");
              await message.react("🛑");

              message
                .createReactionCollector()
                .on("collect", async (reaction, user) => {
                  if (user.bot) return;
                  if (streamEnded) return;
                  reaction.users.remove(user.id);

                  switch (reaction.emoji.name) {
                    case "🇨":
                      stream?.write("\x03");
                      break;
                    case "🇽":
                      stream?.write("\x18");
                      break;
                    case "escape":
                      stream?.write("\x1b");
                      break;
                    case "◀️":
                      stream?.write("\x1b[D");
                      break;
                    case "🔼":
                      stream?.write("\x1b[A");
                      break;
                    case "🔽":
                      stream?.write("\x1b[B");
                      break;
                    case "▶️":
                      stream?.write("\x1b[C");
                      break;
                    case "⬅️":
                      stream?.write("\x08");
                      break;
                    case "↩️":
                      stream?.write("\n");
                      break;
                    case "🛑":
                      sendMessage(channelId, "Stopping shell...");
                      console.log("Stopping shell", channelId + "...");
                      await container.stop();
                      console.log("Stopped shell");
                      break;
                    default:
                      break;
                  }
                });
            } catch {
              console.log("Message removed, stopping reactions...");
            }
          });
        }
        setInterval(sendContent, 2000);

        function onMessage(message: Message) {
          if (message.channelId !== channelId) return;
          if (message.author.bot) return;
          // console.log(message.content);
          const messageContent = message.content;

          const command = checkCommand(options.prefix, messageContent);
          if (streamEnded) {
            if (command === "attach") {
              // client.removeListener("messageCreate", onMessage);
              rej({ reattach: true, channelId: channelId, forceStart: false });
            }
            // TODO: move the global variables inside this function, add parameter options instead.
            // make the function work the same no matter what external conditions
            return;
          }

          stream?.write(messageContent + "\n");

          message.delete();
        }

        client.on("messageCreate", onMessage);
      }
    );
  });
}

async function main(channelIds: string[], forceStart: boolean = false) {
  console.log("Starting...");
  channelIds.forEach(async (id) => {
    console.log("Starting shell", id + "...");
    startShell(id, forceStart).catch((err) => {
      console.log("Error starting shell");
      console.log(err);

      if (err.reattach) {
        console.log("Attempting to reattach...");
        main([err.channelId], err.forceStart);
      }
    });
  });
}

client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (options.channelIds.includes(message.channelId)) return;

  const command = checkCommand(options.prefix, message.content);
  if (command === "start" && message.author.id === options.authorId) {
    options.channelIds.push(message.channelId);
    main([message.channelId]);
  }
});

client.once("ready", () => {
  console.log("Ready!");
  main(options.channelIds);
});

client.login(process.env.TOKEN);
