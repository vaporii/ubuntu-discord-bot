"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dockerode_1 = __importDefault(require("dockerode"));
const dotenv_1 = __importDefault(require("dotenv"));
const discord_js_1 = require("discord.js");
const html_to_text_1 = require("html-to-text");
const xterm_1 = require("@xterm/xterm");
const addon_serialize_1 = require("@xterm/addon-serialize");
dotenv_1.default.config();
const options = {
    rows: 20,
    cols: 40,
    channelIds: process.env.CHANNELS?.split(" "),
    prefix: "u!",
};
const docker = new dockerode_1.default({ socketPath: "/var/run/docker.sock" });
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.Intents.FLAGS.GUILDS,
        discord_js_1.Intents.FLAGS.MESSAGE_CONTENT,
        discord_js_1.Intents.FLAGS.GUILD_MESSAGES,
        discord_js_1.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    ],
});
function checkCommand(prefix, message) {
    if (!message.startsWith(prefix))
        return;
    console.log(message.substring(prefix.length));
    return message.substring(prefix.length);
}
function getContainerByName(name) {
    // filter by name
    var opts = {
        limit: 1,
        filters: `{"name": ["${name}"]}`,
    };
    return new Promise((resolve, reject) => {
        docker.listContainers(opts, function (err, containers) {
            if (err) {
                reject(err);
            }
            else {
                resolve(containers && containers[0]);
            }
        });
    });
}
function sendMessage(channelId, message) {
    const channel = client.channels.cache.get(channelId);
    if (channel?.type === "GUILD_TEXT" ||
        channel?.type === "GUILD_PUBLIC_THREAD" ||
        channel?.type === "GUILD_PRIVATE_THREAD") {
        return channel.send(message);
    }
    throw new Error("Not a text channel");
}
async function createContainer(channelId) {
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
    }
    catch {
        throw new Error("Image does not exist, maybe you didn't build the Dockerfile?");
    }
}
function startShell(channelId, forceStart = false) {
    return new Promise(async (res, rej) => {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            console.log("Failed to load channel", channelId);
            rej("Failed to load channel" + channelId);
        }
        console.log("Starting shell", channelId + "...");
        const terminal = new xterm_1.Terminal({ cols: options.cols, rows: options.rows });
        const serialize = new addon_serialize_1.SerializeAddon();
        terminal.loadAddon(serialize);
        let container;
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
                }
                catch {
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
        }
        else {
            console.log("Creating container...");
            container = await createContainer(channelId);
            console.log("Created container, starting...");
            await container.start();
            console.log("Started");
        }
        await container.resize({ h: options.rows, w: options.cols });
        console.log("Attaching to container...");
        container.attach({ stream: true, stdin: true, stdout: true, stderr: true }, (err, stream) => {
            if (err)
                return console.error(err);
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
                sendMessage(channelId, `**Ubuntu BASH shell stream Ended.**\nTo attempt restarting the shell, use ${options.prefix}attach.`);
                firstMessage?.delete();
                console.log("Shell", channelId, "ended");
            });
            let firstMessage = undefined;
            let output = "";
            let lastOutput = "";
            async function sendContent() {
                if (streamEnded)
                    return;
                const html = serialize.serializeAsHTML({
                    includeGlobalBackground: true,
                    scrollback: 0,
                });
                output =
                    "## Ubuntu BASH Shell\n**Reactions:**\n" +
                        "^C, ^X, Escape, Arrow keys, Backspace, Return/Enter, STOP\n*sudo password is 'password'*" +
                        "```bash\n" +
                        ((0, html_to_text_1.convert)(html).trim().replaceAll("`", "\\`") + " ```").slice(-1850);
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
                            if (user.bot)
                                return;
                            if (streamEnded)
                                return;
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
                    }
                    catch {
                        console.log("Message removed, stopping reactions...");
                    }
                });
            }
            setInterval(sendContent, 2000);
            function onMessage(message) {
                if (message.author.bot)
                    return;
                if (message.channelId !== channelId)
                    return;
                // console.log(message.content);
                const messageContent = message.content;
                if (streamEnded) {
                    const command = checkCommand(options.prefix, messageContent);
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
        });
    });
}
async function main(channelIds, forceStart = false) {
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
client.once("ready", () => {
    console.log("Ready!");
    main(options.channelIds || []);
});
client.login(process.env.TOKEN);
