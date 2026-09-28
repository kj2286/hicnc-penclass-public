import assert from 'node:assert/strict';
import { generatePassword } from '../api/_lib';

const savedRandom = Math.random;
try {
  // Non-cryptographic PRNG failure must not turn temporary credentials into a shared value.
  Math.random = () => 0;
  const passwords = Array.from({ length: 1000 }, () => generatePassword());
  assert.equal(new Set(passwords).size, passwords.length);
  for (const password of passwords) {
    assert.ok(password.length >= 8 && password.length <= 16);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^a-zA-Z0-9]/);
  }
} finally {
  Math.random = savedRandom;
}
console.log('2 PASS / 0 FAIL (독립 임시 비밀번호 발급 및 학생/선생님 비밀번호 정책)');
