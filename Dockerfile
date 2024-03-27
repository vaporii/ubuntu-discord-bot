# Modififed ubuntu image with a regular user

FROM ubuntu

# Install sudo package
RUN apt-get update && \
    apt-get install -y sudo && \
    rm -rf /var/lib/apt/lists/*

# Set non-root user
RUN useradd -m -s /bin/bash ubuntu && \
    echo 'ubuntu:password' | chpasswd && \
    usermod -aG sudo ubuntu

USER ubuntu

CMD ["/bin/bash"]
