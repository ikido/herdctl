#!/bin/bash
# Hurricane Watcher integration test
# Tests that agents can use web tools (WebSearch/WebFetch) to get real data

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/harness.sh"

check_prerequisites
init_scenario "hurricane-watcher"

# =============================================================================
# Tests
# =============================================================================

test_trigger_completes() {
    # Pass explicit prompt for hurricane monitoring
    trigger_and_wait "hurricane-watcher" 120 --prompt "Check for hurricane activity and assess threat to Miami, FL. Format as HURRICANE STATUS REPORT."
    assert_job_completed
}

test_output_has_report_format() {
    # Should have the formatted status report header (case insensitive)
    assert_output_contains "HURRICANE STATUS REPORT" || \
    assert_output_contains "Hurricane Status Report" || \
    assert_output_contains "hurricane status report"
}

test_output_mentions_location() {
    # Should mention Miami
    assert_output_contains "Miami"
}

test_output_mentions_threat() {
    # Should include threat assessment (various formats)
    assert_output_contains "THREAT LEVEL" || \
    assert_output_contains "Threat Level" || \
    assert_output_contains "threat level" || \
    assert_output_contains "Threat:" || \
    assert_output_contains "NONE" || \
    assert_output_contains "None"
}

test_output_has_sources() {
    # Should include sources from web search (indicates tools actually worked)
    assert_output_contains "http" || \
    assert_output_contains "nhc.noaa.gov" || \
    assert_output_contains "Sources:" || \
    assert_output_contains "weather.gov"
}

# =============================================================================
# Run Tests
# =============================================================================

run_test "Agent trigger completes" test_trigger_completes
run_test "Output has report format" test_output_has_report_format
run_test "Output mentions location" test_output_mentions_location
run_test "Output includes threat assessment" test_output_mentions_threat
run_test "Output has sources from web" test_output_has_sources

print_results
