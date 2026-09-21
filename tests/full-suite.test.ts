import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';

// Every scaffold structural test file in the suite. Paths are passed as an
// argv array (not through a shell). NOTE: dynamic-route test files use bare
// param names (e.g. 'tests/struct/foo.test.ts') — NOT '[foo]' — because
// `node --test` treats '[' / ']' as a glob character class and silently skips
// such files (0 tests registered).
//
// This list deliberately EXCLUDES `tests/full-suite.test.ts` itself to avoid
// infinite recursion (the child would rediscover and re-run this wrapper).
//
// Regenerate with: find tests -name '*.test.ts' -not -name 'full-suite.test.ts' | sort
const TEST_FILES: string[] = [
  'tests/actions/actions.test.ts',
  'tests/agents-md.test.ts',
  'tests/api/handlers/actions.test.ts',
  'tests/api/handlers/dev-logs-outcome.test.ts',
  'tests/api/handlers/dev-logs.test.ts',
  'tests/api/handlers/invoices-id.test.ts',
  'tests/api/handlers/invoices-index.test.ts',
  'tests/api/handlers/providers-settings.test.ts',
  'tests/api/handlers/public-invoice-download.test.ts',
  'tests/components.test.ts',
  'tests/contract/user-id.test.ts',
  'tests/db/harness.test.ts',
  'tests/db/invoice-capture-schema.test.ts',
  'tests/db/invoice-logs-schema.test.ts',
  'tests/dev/actions-capture.test.ts',
  'tests/dev/capture.test.ts',
  'tests/dev/ingest-capture.test.ts',
  'tests/dev/simulate-outcome.test.ts',
  'tests/draft/build.test.ts',
  'tests/ingest/ingest.test.ts',
  'tests/ingest/init.test.ts',
  'tests/invoices/accessors.test.ts',
  'tests/lib/crypto.test.ts',
  'tests/lib/data/dev-logs.test.ts',
  'tests/lib/data/settings.test.ts',
  'tests/lib/dev-mode.test.ts',
  'tests/lib/invoice-ready.test.ts',
  'tests/manifest.test.ts',
  'tests/pages/admin-invoices-id-syntax.test.ts',
  'tests/pages/admin-invoices-index-syntax.test.ts',
  'tests/pages/admin-logs-id-syntax.test.ts',
  'tests/pages/admin-logs-index-syntax.test.ts',
  'tests/pages/admin-providers-index-syntax.test.ts',
  'tests/pages/admin-providers-name-syntax.test.ts',
  'tests/providers/fgo-actions.test.ts',
  'tests/providers/fgo-create.test.ts',
  'tests/providers/registry.test.ts',
  'tests/providers/result-types.test.ts',
  'tests/readme.test.ts',
  'tests/schema.test.ts',
  'tests/struct/file-structure.test.ts',
  'tests/struct/schema-settings.test.ts',
];

test('full test suite passes (node --test <all test files>)', () => {
  // CRITICAL: strip NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID from the child env.
  // `node --test` sets these on its own process; if the child `node --test`
  // inherits them it runs as a nested test worker — producing NO reporter
  // output and registering 0 tests while still exiting 0. That makes this suite
  // a silent false green. A clean env forces the child to run as a real
  // top-level test runner.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;
  let output = '';
  try {
    output = execFileSync('node', ['--test', ...TEST_FILES], {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'pipe',
      env: childEnv,
    });
  } catch (err: any) {
    output = err.stdout || err.stderr || '';
    assert.fail(`Test suite failed:\n${output.slice(-2500)}`);
  }
  // Guard against silent false greens: confirm the child actually registered
  // real tests. If this assertion ever fires, the child is skipping every file
  // (glob-bracket paths, env inheritance, or a loader regression).
  const testsLine =
    output.split('\n').find((l) => /^# tests /.test(l)) ||
    output.split('\n').find((l) => /^ℹ tests /.test(l)) ||
    '';
  const m = testsLine.match(/(\d+)/);
  const testCount = m ? parseInt(m[1], 10) : 0;
  assert.ok(
    testCount >= 15,
    `child node --test registered only ${testCount} tests — expected >=15; possible silent skip. Output tail:\n${output.slice(-1500)}`
  );
});
