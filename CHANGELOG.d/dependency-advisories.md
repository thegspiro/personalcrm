### Nothing outstanding from the security audit — 2026-09-06

*Schema: none*

#### Fixed
- **Six published vulnerabilities in bundled dependencies are cleared**, and the
  audit now reports none. The image-processing library shipped inside Next had
  four; the CSS toolchain Next pins had four more, including one that could be
  made to read arbitrary files from the machine; and the configuration reader
  the database CLI uses could be made to exhaust the stack. That last one
  matters more than it sounds: the CLI runs inside the container at every start
  to apply migrations, so it was not confined to development machines.
- **None of this required a major upgrade.** Next moved by a patch release
  within the range it was already on, and the two remaining libraries are pinned
  forward explicitly. Nothing about how the app is configured or deployed
  changes, and there is nothing to do on upgrade beyond pulling the new image.
