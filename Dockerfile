# Dockerfile for herdctl Docker runtime
#
# This image provides a containerized environment for running Claude Code agents
# via the CLI runtime. It includes Node.js and the Claude CLI.

FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# The Claude CLI will be executed via docker exec
# No ENTRYPOINT or CMD needed - container stays running
CMD ["tail", "-f", "/dev/null"]
