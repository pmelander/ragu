---
description: Re-index project documents into ragU
---

Re-index this project's documents into the ragU knowledge base using the config below.

**Project root:** !`pwd`

**Config (`.opencode/ragu.json`):**
!`cat .opencode/ragu.json 2>/dev/null || echo '{"error":"No .opencode/ragu.json found. Create it with \"collection\" and \"paths\" fields, or delete it to trigger auto-creation on the next OpenCode startup."}'`

Using the `collection` and `paths` values above, call `rag_upload` for each entry in `paths`. Resolve relative paths from the project root. Skip paths that do not exist on disk. When finished, report how many files were indexed and list any errors.
