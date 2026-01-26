#!/bin/bash
# Hurricane Watcher integration test
# Tests a practical agent that monitors weather threats

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/harness.sh"

check_prerequisites
init_scenario "hurricane-watcher"

# =============================================================================
# Tests
# =============================================================================

test_trigger_completes() {
    # Hurricane check might take a bit longer due to web searches
    trigger_and_wait "hurricane-watcher" 120
    assert_job_completed
}

test_output_has_status_report() {
    # Should have the formatted status report
    assert_output_contains "HURRICANE STATUS REPORT" || \
    assert_output_contains "Threat Level" || \
    assert_output_contains "Status"
}

test_output_mentions_location() {
    # Should mention Miami or Florida
    assert_output_contains "Miami" || assert_output_contains "Florida"
}

# =============================================================================
# Run Tests
# =============================================================================

run_test "Agent trigger completes" test_trigger_completes
run_test "Output has status report format" test_output_has_status_report
run_test "Output mentions monitored location" test_output_mentions_location

print_results
