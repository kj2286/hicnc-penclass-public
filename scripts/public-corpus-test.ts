import assert from 'node:assert/strict';
import { assessmentContext } from '../api/_essay-assessment';
import { findKoreanGradingExamples, koreanGradingGuidance, gradingOcrPrompt } from '../api/_korean-grading';

assert.deepEqual(assessmentContext('영어', 'Explain the evidence for the argument.'), { prompt: '', references: [] });
assert.deepEqual(assessmentContext('국어', '논증의 타당성과 근거를 설명하시오.'), { prompt: '', references: [] });
assert.deepEqual(findKoreanGradingExamples('논증의 타당성과 근거'), []);
assert.equal(koreanGradingGuidance('국어', '논증의 타당성과 근거'), '');
assert.equal(koreanGradingGuidance('국어', '논증의 타당성과 근거', 'analysis'), '');
assert.equal(gradingOcrPrompt('교사의 문항별 채점 기준', { subject: '국어', question: '근거를 설명하시오.' }), '교사의 문항별 채점 기준');
assert.equal(gradingOcrPrompt(undefined, { subject: '국어', question: '근거를 설명하시오.' }), undefined);
assert.equal(gradingOcrPrompt('영어 기준', { subject: '영어', question: 'Explain.' }), '영어 기준');
console.log('8 PASS / 0 FAIL (공개본 빈 코퍼스 및 기존 문항 기준 보존)');
