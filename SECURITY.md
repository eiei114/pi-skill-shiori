# Security Policy

## Supported versions

Only the latest published version receives security fixes.

## Reporting a vulnerability

Open a private security advisory on GitHub, or contact the maintainer by the preferred channel listed in the repository profile.

Please include:

- Affected version
- Impact
- Reproduction steps
- Suggested fix, if known

## Pi package security note

Pi packages can execute code with local user permissions. Review installed packages and avoid running untrusted extensions.

Pi Skill Shiori does not sandbox skills. It changes how skill candidates are discovered and loaded. A loaded skill can still instruct the model to run tools, edit files, or execute commands according to your Pi and tool permissions.
