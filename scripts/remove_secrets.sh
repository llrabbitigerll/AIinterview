#!/usr/bin/env bash
set -euo pipefail

# Safe helper to remove local .env from git index, create .env.example if missing,
# and ensure .env is ignored. Does NOT overwrite existing .env.example.

REPO_ROOT="$(pwd)"
ENV_FILE="$REPO_ROOT/.env"
EXAMPLE="$REPO_ROOT/.env.example"
SERVER_EXAMPLE="$REPO_ROOT/server/.env.example"
GITIGNORE="$REPO_ROOT/.gitignore"

if [ ! -f "$EXAMPLE" ]; then
  if [ -f "$SERVER_EXAMPLE" ]; then
    cp "$SERVER_EXAMPLE" "$EXAMPLE"
    echo "Created ./ .env.example by copying server/.env.example"
  else
    echo "# Example environment variables - fill with your values" > "$EXAMPLE"
    echo "# e.g. OPENAI_API_KEY=YOUR_KEY" >> "$EXAMPLE"
    echo "Created minimal .env.example"
  fi
else
  echo ".env.example already exists at repository root, not overwriting."
fi

if ! grep -q "^\.env$" "$GITIGNORE" 2>/dev/null; then
  printf "\n# local env\n.env\n" >> "$GITIGNORE"
  echo "Added .env to .gitignore"
else
  echo ".env already present in .gitignore"
fi

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  git rm --cached .env
  echo ".env was tracked. To auto-commit removal, run: git add .gitignore && git commit -m 'Remove .env from repo and add to .gitignore'"
else
  echo ".env not tracked by git"
fi

if [ -f "$ENV_FILE" ]; then
  rm -f "$ENV_FILE"
  echo "Deleted local .env"
else
  echo "No local .env file to delete"
fi
