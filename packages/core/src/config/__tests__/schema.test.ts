import { describe, it, expect } from "vitest";
import {
  FleetConfigSchema,
  DefaultsSchema,
  WorkspaceSchema,
  PermissionsSchema,
  PermissionModeSchema,
  WorkSourceSchema,
  GitHubWorkSourceSchema,
  GitHubAuthSchema,
  BaseWorkSourceSchema,
  DockerSchema,
  ChatSchema,
  WebhooksSchema,
  InstancesSchema,
  AgentReferenceSchema,
} from "../schema.js";

describe("FleetConfigSchema", () => {
  it("parses minimal config", () => {
    const result = FleetConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.agents).toEqual([]);
    }
  });

  it("parses complete config", () => {
    const config = {
      version: 1,
      fleet: { name: "test", description: "test fleet" },
      defaults: {},
      workspace: { root: "/tmp" },
      agents: [{ path: "./test.yaml" }],
      chat: {},
      webhooks: {},
      docker: {},
    };
    const result = FleetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects invalid version", () => {
    const result = FleetConfigSchema.safeParse({ version: "1" });
    expect(result.success).toBe(false);
  });

  it("rejects negative version", () => {
    const result = FleetConfigSchema.safeParse({ version: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero version", () => {
    const result = FleetConfigSchema.safeParse({ version: 0 });
    expect(result.success).toBe(false);
  });
});

describe("DefaultsSchema", () => {
  it("parses empty defaults", () => {
    const result = DefaultsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses complete defaults", () => {
    const defaults = {
      docker: { enabled: true },
      permissions: { mode: "acceptEdits" },
      work_source: { type: "github" },
      instances: { max_concurrent: 2 },
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.docker?.enabled).toBe(true);
      expect(result.data.permissions?.mode).toBe("acceptEdits");
      expect(result.data.work_source?.type).toBe("github");
      expect(result.data.instances?.max_concurrent).toBe(2);
    }
  });

  it("parses extended defaults with session", () => {
    const defaults = {
      session: {
        max_turns: 50,
        timeout: "30m",
        model: "claude-sonnet-4-20250514",
      },
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session?.max_turns).toBe(50);
      expect(result.data.session?.timeout).toBe("30m");
      expect(result.data.session?.model).toBe("claude-sonnet-4-20250514");
    }
  });

  it("parses extended defaults with model", () => {
    const defaults = {
      model: "claude-opus-4-20250514",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("claude-opus-4-20250514");
    }
  });

  it("parses extended defaults with max_turns", () => {
    const defaults = {
      max_turns: 100,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_turns).toBe(100);
    }
  });

  it("parses extended defaults with permission_mode", () => {
    const defaults = {
      permission_mode: "bypassPermissions",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permission_mode).toBe("bypassPermissions");
    }
  });

  it("parses complete extended defaults", () => {
    const defaults = {
      docker: { enabled: false },
      permissions: {
        mode: "acceptEdits",
        allowed_tools: ["Read", "Write"],
      },
      work_source: {
        type: "github",
        labels: { ready: "ready" },
      },
      instances: { max_concurrent: 3 },
      session: {
        max_turns: 50,
        timeout: "1h",
      },
      model: "claude-sonnet-4-20250514",
      max_turns: 100,
      permission_mode: "acceptEdits",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session?.max_turns).toBe(50);
      expect(result.data.model).toBe("claude-sonnet-4-20250514");
      expect(result.data.max_turns).toBe(100);
      expect(result.data.permission_mode).toBe("acceptEdits");
    }
  });

  it("rejects invalid permission_mode", () => {
    const defaults = {
      permission_mode: "invalid",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });

  it("rejects negative max_turns", () => {
    const defaults = {
      max_turns: -1,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });

  it("rejects zero max_turns", () => {
    const defaults = {
      max_turns: 0,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });

  it("rejects non-integer max_turns", () => {
    const defaults = {
      max_turns: 1.5,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });
});

describe("WorkspaceSchema", () => {
  it("requires root", () => {
    const result = WorkspaceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses with root only", () => {
    const result = WorkspaceSchema.safeParse({ root: "/tmp/workspace" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.root).toBe("/tmp/workspace");
      expect(result.data.auto_clone).toBe(true);
      expect(result.data.clone_depth).toBe(1);
      expect(result.data.default_branch).toBe("main");
    }
  });

  it("parses complete workspace config", () => {
    const workspace = {
      root: "~/herdctl-workspace",
      auto_clone: false,
      clone_depth: 5,
      default_branch: "develop",
    };
    const result = WorkspaceSchema.safeParse(workspace);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_clone).toBe(false);
      expect(result.data.clone_depth).toBe(5);
      expect(result.data.default_branch).toBe("develop");
    }
  });

  it("rejects non-integer clone_depth", () => {
    const result = WorkspaceSchema.safeParse({
      root: "/tmp",
      clone_depth: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero clone_depth", () => {
    const result = WorkspaceSchema.safeParse({ root: "/tmp", clone_depth: 0 });
    expect(result.success).toBe(false);
  });
});

describe("PermissionsSchema", () => {
  it("applies default mode", () => {
    const result = PermissionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("acceptEdits");
    }
  });

  it("parses all fields", () => {
    const permissions = {
      mode: "bypassPermissions",
      allowed_tools: ["Read", "Edit"],
      denied_tools: ["WebSearch"],
      bash: {
        allowed_commands: ["git", "npm"],
        denied_patterns: ["rm -rf /"],
      },
    };
    const result = PermissionsSchema.safeParse(permissions);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("bypassPermissions");
      expect(result.data.allowed_tools).toEqual(["Read", "Edit"]);
      expect(result.data.denied_tools).toEqual(["WebSearch"]);
      expect(result.data.bash?.allowed_commands).toEqual(["git", "npm"]);
    }
  });
});

describe("PermissionModeSchema", () => {
  it("accepts valid modes", () => {
    const validModes = ["default", "acceptEdits", "bypassPermissions", "plan"];
    for (const mode of validModes) {
      const result = PermissionModeSchema.safeParse(mode);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid modes", () => {
    const result = PermissionModeSchema.safeParse("invalid");
    expect(result.success).toBe(false);
  });
});

describe("WorkSourceSchema", () => {
  it("requires type", () => {
    const result = WorkSourceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses minimal github type (base schema)", () => {
    const result = WorkSourceSchema.safeParse({ type: "github" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("github");
    }
  });

  it("parses with labels (base schema)", () => {
    const workSource = {
      type: "github",
      labels: {
        ready: "ready",
        in_progress: "in-progress",
      },
      cleanup_in_progress: true,
    };
    const result = WorkSourceSchema.safeParse(workSource);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels?.ready).toBe("ready");
      expect(result.data.cleanup_in_progress).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    const result = WorkSourceSchema.safeParse({ type: "jira" });
    expect(result.success).toBe(false);
  });

  it("parses full GitHub work source configuration", () => {
    const workSource = {
      type: "github",
      repo: "owner/repo-name",
      labels: {
        ready: "ready-for-agent",
        in_progress: "agent-working",
      },
      exclude_labels: ["blocked", "wip"],
      cleanup_on_failure: true,
      auth: {
        token_env: "MY_GITHUB_TOKEN",
      },
    };
    const result = WorkSourceSchema.safeParse(workSource);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("github");
      expect(result.data).toHaveProperty("repo", "owner/repo-name");
    }
  });
});

describe("GitHubWorkSourceSchema", () => {
  describe("repo field validation", () => {
    it("requires repo field", () => {
      const result = GitHubWorkSourceSchema.safeParse({ type: "github" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("repo"))).toBe(
          true
        );
      }
    });

    it("accepts valid owner/repo format", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "octocat/hello-world",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repo).toBe("octocat/hello-world");
      }
    });

    it("accepts repo with hyphens and underscores", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "my-org/my_repo-name",
      });
      expect(result.success).toBe(true);
    });

    it("accepts repo with dots", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "org.name/repo.name",
      });
      expect(result.success).toBe(true);
    });

    it("accepts repo with numbers", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "org123/repo456",
      });
      expect(result.success).toBe(true);
    });

    it("rejects repo without slash", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "just-repo-name",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("owner/repo");
      }
    });

    it("rejects repo with multiple slashes", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo/extra",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty repo", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects repo with spaces", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner name/repo name",
      });
      expect(result.success).toBe(false);
    });

    it("provides clear error message for invalid repo format", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "invalid",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const repoError = result.error.issues.find((i) =>
          i.path.includes("repo")
        );
        expect(repoError?.message).toContain("owner/repo");
        expect(repoError?.message).toContain("octocat/hello-world");
      }
    });
  });

  describe("labels field", () => {
    it("applies default labels when not specified", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("ready");
        expect(result.data.labels.in_progress).toBe("agent-working");
      }
    });

    it("allows custom ready label", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        labels: { ready: "custom-ready" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("custom-ready");
        expect(result.data.labels.in_progress).toBe("agent-working");
      }
    });

    it("allows custom in_progress label", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        labels: { in_progress: "working-on-it" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("ready");
        expect(result.data.labels.in_progress).toBe("working-on-it");
      }
    });

    it("allows both custom labels", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        labels: {
          ready: "todo",
          in_progress: "doing",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("todo");
        expect(result.data.labels.in_progress).toBe("doing");
      }
    });
  });

  describe("exclude_labels field", () => {
    it("defaults to empty array", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude_labels).toEqual([]);
      }
    });

    it("accepts array of strings", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        exclude_labels: ["blocked", "wip", "on-hold"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude_labels).toEqual([
          "blocked",
          "wip",
          "on-hold",
        ]);
      }
    });

    it("accepts empty array", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        exclude_labels: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude_labels).toEqual([]);
      }
    });

    it("rejects non-string array items", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        exclude_labels: ["valid", 123],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("cleanup_on_failure field", () => {
    it("defaults to true", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup_on_failure).toBe(true);
      }
    });

    it("accepts explicit true", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        cleanup_on_failure: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup_on_failure).toBe(true);
      }
    });

    it("accepts false", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        cleanup_on_failure: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup_on_failure).toBe(false);
      }
    });

    it("rejects non-boolean values", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        cleanup_on_failure: "yes",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("auth field", () => {
    it("defaults auth.token_env to GITHUB_TOKEN", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth.token_env).toBe("GITHUB_TOKEN");
      }
    });

    it("accepts custom token_env", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        auth: { token_env: "MY_GITHUB_PAT" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth.token_env).toBe("MY_GITHUB_PAT");
      }
    });

    it("accepts empty auth object (uses defaults)", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        auth: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth.token_env).toBe("GITHUB_TOKEN");
      }
    });
  });

  describe("complete configuration", () => {
    it("parses complete GitHub work source config", () => {
      const config = {
        type: "github",
        repo: "my-org/my-repo",
        labels: {
          ready: "ready-for-work",
          in_progress: "in-progress",
        },
        exclude_labels: ["blocked", "wip", "needs-review"],
        cleanup_on_failure: false,
        auth: {
          token_env: "GH_ENTERPRISE_TOKEN",
        },
      };
      const result = GitHubWorkSourceSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          type: "github",
          repo: "my-org/my-repo",
          labels: {
            ready: "ready-for-work",
            in_progress: "in-progress",
          },
          exclude_labels: ["blocked", "wip", "needs-review"],
          cleanup_on_failure: false,
          auth: {
            token_env: "GH_ENTERPRISE_TOKEN",
          },
        });
      }
    });

    it("applies all defaults for minimal config", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("github");
        expect(result.data.repo).toBe("owner/repo");
        expect(result.data.labels.ready).toBe("ready");
        expect(result.data.labels.in_progress).toBe("agent-working");
        expect(result.data.exclude_labels).toEqual([]);
        expect(result.data.cleanup_on_failure).toBe(true);
        expect(result.data.auth.token_env).toBe("GITHUB_TOKEN");
      }
    });
  });
});

describe("GitHubAuthSchema", () => {
  it("applies default token_env", () => {
    const result = GitHubAuthSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_env).toBe("GITHUB_TOKEN");
    }
  });

  it("accepts custom token_env", () => {
    const result = GitHubAuthSchema.safeParse({ token_env: "CUSTOM_TOKEN" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_env).toBe("CUSTOM_TOKEN");
    }
  });
});

describe("BaseWorkSourceSchema", () => {
  it("parses minimal config", () => {
    const result = BaseWorkSourceSchema.safeParse({ type: "github" });
    expect(result.success).toBe(true);
  });

  it("parses with optional fields", () => {
    const result = BaseWorkSourceSchema.safeParse({
      type: "github",
      labels: { ready: "todo" },
      cleanup_in_progress: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("DockerSchema", () => {
  it("applies default enabled", () => {
    const result = DockerSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it("parses complete docker config", () => {
    const docker = {
      enabled: true,
      base_image: "herdctl-base:latest",
    };
    const result = DockerSchema.safeParse(docker);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.base_image).toBe("herdctl-base:latest");
    }
  });
});

describe("ChatSchema", () => {
  it("parses empty chat", () => {
    const result = ChatSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses discord config", () => {
    const chat = {
      discord: {
        enabled: true,
        token_env: "DISCORD_TOKEN",
      },
    };
    const result = ChatSchema.safeParse(chat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.enabled).toBe(true);
      expect(result.data.discord?.token_env).toBe("DISCORD_TOKEN");
    }
  });

  it("applies default discord enabled", () => {
    const result = ChatSchema.safeParse({ discord: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.enabled).toBe(false);
    }
  });
});

describe("WebhooksSchema", () => {
  it("applies defaults", () => {
    const result = WebhooksSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.port).toBe(8081);
    }
  });

  it("parses complete webhooks config", () => {
    const webhooks = {
      enabled: true,
      port: 9000,
      secret_env: "WEBHOOK_SECRET",
    };
    const result = WebhooksSchema.safeParse(webhooks);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.port).toBe(9000);
      expect(result.data.secret_env).toBe("WEBHOOK_SECRET");
    }
  });

  it("rejects negative port", () => {
    const result = WebhooksSchema.safeParse({ port: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero port", () => {
    const result = WebhooksSchema.safeParse({ port: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer port", () => {
    const result = WebhooksSchema.safeParse({ port: 80.5 });
    expect(result.success).toBe(false);
  });
});

describe("InstancesSchema", () => {
  it("applies default max_concurrent", () => {
    const result = InstancesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_concurrent).toBe(1);
    }
  });

  it("parses custom max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_concurrent).toBe(5);
    }
  });

  it("rejects negative max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("AgentReferenceSchema", () => {
  it("requires path", () => {
    const result = AgentReferenceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses valid path", () => {
    const result = AgentReferenceSchema.safeParse({
      path: "./agents/test.yaml",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("./agents/test.yaml");
    }
  });

  it("parses absolute path", () => {
    const result = AgentReferenceSchema.safeParse({
      path: "/etc/herdctl/agent.yaml",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("/etc/herdctl/agent.yaml");
    }
  });
});
