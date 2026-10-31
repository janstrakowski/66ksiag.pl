# Shared ref detection for Origin CI publish scripts.
# shellcheck shell=bash

publish_detect_ref() {
  PUBLISH_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  PUBLISH_REF="${ORIGIN_REF_NAME:-${GITHUB_REF_NAME:-${CI_COMMIT_REF_NAME:-${BUILDKITE_BRANCH:-}}}}"
  local raw="${GITHUB_REF:-${ORIGIN_REF:-${CI_COMMIT_REF:-}}}"
  case "$raw" in
    refs/heads/dev) PUBLISH_REF="dev" ;;
    refs/heads/main) PUBLISH_REF="main" ;;
  esac
}

publish_is_main() {
  [[ "${PUBLISH_BRANCH:-}" == "main" || "${PUBLISH_REF:-}" == "main" ]]
}

publish_is_dev() {
  [[ "${PUBLISH_BRANCH:-}" == "dev" || "${PUBLISH_REF:-}" == "dev" ]]
}
