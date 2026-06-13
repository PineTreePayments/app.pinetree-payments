<?php
/**
 * Minimal test runner for the WooCommerce PineTree plugin.
 *
 * Usage:  php plugins/woocommerce-pinetree/tests/run.php
 *
 * No PHPUnit required. Outputs TAP-style lines and exits non-zero on failure.
 */

declare(strict_types=1);

$GLOBALS['_test_pass']  = 0;
$GLOBALS['_test_fail']  = 0;
$GLOBALS['_test_errors'] = [];

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function assert_true(bool $condition, string $label): void {
    if ($condition) {
        echo "ok - {$label}\n";
        $GLOBALS['_test_pass']++;
    } else {
        echo "not ok - {$label}\n";
        $GLOBALS['_test_fail']++;
        $GLOBALS['_test_errors'][] = $label;
    }
}

function assert_false(bool $condition, string $label): void {
    assert_true(!$condition, $label);
}

function assert_equals($expected, $actual, string $label): void {
    $ok = $expected === $actual;
    if (!$ok) {
        $exp = var_export($expected, true);
        $got = var_export($actual, true);
        assert_true(false, "{$label} (expected {$exp}, got {$got})");
    } else {
        assert_true(true, $label);
    }
}

// ---------------------------------------------------------------------------
// Load and run test suites
// ---------------------------------------------------------------------------

$suites = [
    __DIR__ . '/PineTreeApiTest.php',
    __DIR__ . '/PineTreeWebhookTest.php',
];

foreach ($suites as $suite) {
    require_once $suite;

    // Collect and invoke every top-level function named test_*
    $functions = array_filter(
        get_defined_functions()['user'],
        fn($name) => str_starts_with($name, 'test_')
    );
}

// Run all test_ functions (gathered after loading both suites)
$all_test_fns = array_filter(
    get_defined_functions()['user'],
    fn($name) => str_starts_with($name, 'test_')
);

echo "TAP version 14\n";
echo '1..' . count($all_test_fns) . " (assertions)\n\n";

foreach ($all_test_fns as $fn) {
    $fn();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

$total = $GLOBALS['_test_pass'] + $GLOBALS['_test_fail'];
echo "\n# Results: {$GLOBALS['_test_pass']} passed, {$GLOBALS['_test_fail']} failed out of {$total} assertions\n";

if ($GLOBALS['_test_fail'] > 0) {
    echo "# Failed:\n";
    foreach ($GLOBALS['_test_errors'] as $err) {
        echo "#   - {$err}\n";
    }
    exit(1);
}

exit(0);
