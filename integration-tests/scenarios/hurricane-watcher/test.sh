#!/bin/bash
# Hurricane Watcher integration test
# Tests a practical agent that monitors weather threats
#
# NOTE: This test validates basic agent functionality. Tool access (WebSearch/
# WebFetch) is a separate feature - without tools, the agent will respond
# generically about hurricanes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/harness.sh"

check_prerequisites
init_scenario "hurricane-watcher"

# =============================================================================
# Tests
# =============================================================================

test_trigger_completes() {
    # Pass explicit prompt since trigger doesn't use schedule prompts by default
    trigger_and_wait "hurricane-watcher" 120 --prompt "What is the current hurricane activity status for Miami, Florida? Provide a brief status report."
    assert_job_completed
}

test_output_is_relevant() {
    # Should respond about hurricanes, weather, or the request
    # Note: Without tool access, the agent may give a generic response
    assert_output_contains "hurricane" || \
    assert_output_contains "Hurricane" || \
    assert_output_contains "storm" || \
    assert_output_contains "weather" || \
    assert_output_contains "permission"  # Agent may say it needs permission for tools
}

# =============================================================================
# Run Tests
# =============================================================================

run_test "Agent trigger completes" test_trigger_completes
run_test "Output is relevant to request" test_output_is_relevant

print_results
