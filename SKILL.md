---
name: install-openwiz
description: Install OpenWiz, the open kernel for agent factories, from its one line "Install OpenWiz from github.com/openwizdev/OpenWiz". Use when the user asks to install, set up, repair or update OpenWiz. Hands off to OpenWiz's own install skill, which does the work.
---

# Install OpenWiz

OpenWiz installs from one line. When the user wants OpenWiz, treat it as if they had said:

> Install OpenWiz from github.com/openwizdev/OpenWiz

This file is only the way in. It installs nothing itself and adds no steps of its own.

1. Read OpenWiz's install skill, from WizSkills v0.3.1: https://github.com/openwizdev/WizSkills/blob/v0.3.1/skills/install/SKILL.md (raw: https://raw.githubusercontent.com/openwizdev/WizSkills/v0.3.1/skills/install/SKILL.md).
2. Follow it from the top, exactly as written. It asks first where the user's agents run, checks the computer, installs the verified prebuilt release, and waits for the user's yes before every change.
3. Where it and this file differ, the install skill wins.

Good to know before you start:

- Supported: macOS on Apple silicon, or Linux on x86_64 with glibc 2.34 or later. It needs Python 3.9 or later, git and the GitHub CLI (gh).
- CloudRoom is optional. Never present it as required.
- Never ask for a key or token in chat.
- For people, every step and command is in the install guide: https://github.com/openwizdev/OpenWiz/blob/main/docs/install.md
