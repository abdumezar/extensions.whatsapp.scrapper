const assert = require('assert');
const { parsePhone } = require('../src/lib/phone.js');

let p = parsePhone('201001234567');
assert.strictEqual(p.country_code, '20'); assert.strictEqual(p.country_iso, 'EG'); assert.strictEqual(p.country_name, 'Egypt');
assert.strictEqual(p.phone_number, '201001234567'); assert.strictEqual(p.formatted_phone.replace(/\s/g,''), '+201001234567'); assert.ok(/^\+20 /.test(p.formatted_phone)); assert.strictEqual(p.valid, true);

p = parsePhone('14155550100');
assert.strictEqual(p.country_code, '1'); assert.strictEqual(p.country_iso, 'US'); assert.strictEqual(p.formatted_phone.replace(/\s/g,''), '+14155550100');

p = parsePhone('447400123456');
assert.strictEqual(p.country_iso, 'GB'); assert.strictEqual(p.country_name, 'United Kingdom');

p = parsePhone('966501234567');
assert.strictEqual(p.country_iso, 'SA'); assert.strictEqual(p.country_name, 'Saudi Arabia');

p = parsePhone('5511987654321'); // Brazil mobile with 9
assert.strictEqual(p.country_iso, 'BR'); assert.strictEqual(p.country_code, '55');

p = parsePhone('5215512345678'); // Mexico legacy +52 1
assert.strictEqual(p.country_code, '52'); assert.strictEqual(p.country_iso, 'MX');

p = parsePhone('7', 'en'); // garbage
assert.strictEqual(p.country_code, ''); assert.strictEqual(p.formatted_phone, '+7');

p = parsePhone('', 'en');
assert.strictEqual(p.phone_number, ''); assert.strictEqual(p.formatted_phone, '');

p = parsePhone('201001234567', 'ar');
assert.strictEqual(p.country_name, 'مصر');
console.log('phone.test.js ok');
