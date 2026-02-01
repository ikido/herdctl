# Phase 3: Docker Integration - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Provide optional Docker containerization for security isolation with configurable resource limits. This phase wraps existing runtimes (SDK or CLI) in Docker containers using a decorator pattern. The ContainerRunner transparently wraps any runtime, providing security boundaries, resource limits, and path translation between host and container environments.

New capabilities beyond Docker integration belong in other phases.

</domain>

<decisions>
## Implementation Decisions

### Container Lifecycle
- **Reuse strategy**: Configurable per agent - agent config can specify ephemeral (--rm, fresh per job) vs persistent (reuse container across jobs)
- **Post-job behavior**: Keep containers for inspection after job completion, cleanup based on max count limit
- **Failure handling**: Fail job immediately if container fails to start or crashes mid-job (no retries, no fallback to non-Docker)
- **Cleanup strategy**: Max count limit - keep last N containers per agent, remove oldest when limit exceeded

### Security Boundaries & Permissions
- **Credential handling**: Support both environment variable (preferred) and mounted auth file (read-only). Try env var first, fall back to mounted file if needed for CLI runtime compatibility
- **Network isolation**: Configurable per agent - agent config specifies network mode (none/bridge/host), defaults to bridge (full network access)
- **User permissions**: Configurable per agent - default to non-root user (match host UID/GID to avoid permission issues), but allow explicit root configuration if needed

### Claude's Discretion
- Resource limit defaults (memory/CPU caps)
- Specific Docker security flags beyond user/network
- Path translation implementation details
- Session file storage structure in .herdctl/docker-sessions/
- Container naming convention
- Max container count default value
- Image selection and management

</decisions>

<specifics>
## Specific Ideas

- Container reuse was discussed to optimize for speed (avoid 2-5s startup overhead), configurability allows agents to choose based on their needs
- Tradeoff recognized: reuse for speed vs fresh containers for security/simplicity
- Keep containers for inspection to enable debugging of failed jobs
- Both SDK and CLI runtimes must work equally well in containers

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 03-docker-integration*
*Context gathered: 2026-02-01*
