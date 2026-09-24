# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

---

## Token & Credential Security

`puter-ai-cli` handles Puter authentication tokens with strict security best practices:
- Tokens are stored locally on POSIX systems with `0600` (user read/write only) file permissions.
- The configuration directory `~/.config/mycli` is created with restricted `0700` permissions.
- Tokens are never logged to `stdout`, and `mycli auth status` / `mycli auth list` display masked tokens only (`eyJh...IXy4`).
- No tokens or personal identifiers are stored in the git repository.

---

## Reporting a Vulnerability

If you discover a potential security vulnerability within this project, please **do not open a public issue**. Instead, report it privately via GitHub Security Advisories or contact the maintainer directly.

We appreciate your efforts to responsibly disclose findings and will investigate and respond promptly.
