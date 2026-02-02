---
"@herdctl/core": minor
---

Add Docker container runtime support for agent execution

Agents can now be executed inside Docker containers instead of directly on the host machine. This provides better isolation, environment control, and resource management.

**New Configuration**:
```yaml
docker:
  enabled: true
  image: "anthropics/claude-code:latest"
  workspaceMode: "rw"  # or "ro" for read-only
  cpus: 2.0
  memory: "2g"
  network: "bridge"
  mounts:
    - hostPath: "/host/path"
      containerPath: "/container/path"
      mode: "rw"
  environment:
    KEY: "value"
```

**Features**:
- Container-based agent execution with full isolation
- Configurable resource limits (CPU, memory)
- Volume mounting for workspace and custom paths
- Environment variable injection
- Network configuration (bridge, host, none)
- Automatic image pulling and container lifecycle management
- Works with both SDK and CLI runtimes

**Use Cases**:
- Run agents in isolated environments
- Control resource usage per agent
- Ensure consistent execution environments
- Enhanced security through containerization
