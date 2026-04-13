const { PyBridge } = require('../src');
const assert = require('assert');

async function runTests() {
  const py = new PyBridge({ pythonPath: 'python' }); // 'python' or 'python3' depending on system

  try {
    console.log('--- Starting Bridge ---');
    await py.start();
    console.log('Bridge started.');

    // 1. Basic Call
    console.log('Testing basic call...');
    const result = await py.call('math', 'sqrt', [16]);
    console.log('math.sqrt(16) =', result);
    assert.strictEqual(result, 4);

    // 2. Keyword Arguments
    console.log('Testing kwargs...');
    const pathResult = await py.call('os.path', 'join', ['usr', 'local', 'bin']);
    console.log('os.path.join =', pathResult);
    // Path might vary by OS, but let's check it's a string
    assert.strictEqual(typeof pathResult, 'string');

    // 3. Error Handling
    console.log('Testing error handling...');
    try {
      await py.call('non_existent', 'func');
    } catch (err) {
      console.log('Caught expected error:', err.message);
      assert.strictEqual(err.name, 'PythonError');
      assert.ok(err.type.includes('ModuleNotFoundError') || err.type.includes('ImportError'));
    }

    // 4. Timeouts
    console.log('Testing timeout...');
    try {
      await py.call('time', 'sleep', [2], {}, 500);
    } catch (err) {
      console.log('Caught expected timeout:', err.message);
      assert.ok(err.message.includes('timed out'));
    }

    console.log('\n--- All Basic Bridge Tests Passed! ---');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    await py.stop();
  }
}

runTests();
