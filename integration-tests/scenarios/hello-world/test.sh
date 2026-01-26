#!/bin/bash
# Hello World integration test
# Tests basic agent triggering and job completion

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/harness.sh"

check_prerequisites
init_scenario "hello-world"

# =============================================================================
# Tests
# =============================================================================

test_trigger_completes() {
    trigger_and_wait "hello-agent" 60
    assert_job_completed
}

test_output_contains_hello() {
    # The agent should have responded with hello
    assert_output_contains "Hello"
}

# =============================================================================
# Run Tests
# =============================================================================

run_test "Agent trigger completes" test_trigger_completes
run_test "Output contains hello" test_output_contains_hello

print_results
