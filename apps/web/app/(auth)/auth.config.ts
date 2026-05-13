export const authConfig = {
  pages: {
    signIn: "/guest-login",
    newUser: "/",
  },
  trustHost: true,
  providers: [
    // added later in auth.ts since it requires bcrypt which is only compatible with Node.js
    // while this file is also used in non-Node.js environments
  ],
  callbacks: {},
  signOut: {
    redirect: true,
  },
};

export const slackAuthConfig = {
  display_information: {
    name: "openloomi",
    description:
      "openloomi is a simple AI IM router and chat agent as your work partner for multiple platforms.",
    background_color: "#4A154B",
  },
  oauth_config: {
    params: {
      scope: [
        "channels:history",
        "channels:read",
        "chat:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "users:read",
        "users:write",
        "channels:join",
        "users:read.email",
        "team:read",
      ],
      user_scope: [
        "channels:history",
        "channels:read",
        "chat:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "mpim:history",
        "mpim:read",
        "users:read",
        "team:read",
        "search:read",
        "search:read.files",
        "search:read.im",
        "search:read.mpim",
        "search:read.private",
        "search:read.public",
        "search:read.users",
      ],
    },
  },
  settings: {
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  },
};

// Jira Cloud OAuth 2.0 configuration
export const jiraAuthConfig = {
  oauth_config: {
    params: {
      scope: [
        "read:jira-work",
        "read:jira-user",
        "write:jira-work",
        "offline_access",
      ],
      prompt: "consent",
    },
  },
};

// Linear OAuth 2.0 configuration
export const linearAuthConfig = {
  oauth_config: {
    params: {
      scope: [
        "read",
        "write",
        "issues:create",
        "comments:create",
        "projects:create",
      ],
      prompt: "consent",
    },
  },
};
