import { describe, it, expect } from 'vitest';
import { toCsv, csvField, csvFilename } from '../src';

describe('csvField', () => {
  it('leaves a plain value alone', () => {
    expect(csvField('Fatima Ahmed')).toBe('Fatima Ahmed');
  });
  it('quotes a value with a comma', () => {
    expect(csvField('Ahmed, Fatima')).toBe('"Ahmed, Fatima"');
  });
  it('quotes and doubles an embedded quote', () => {
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
  });
  it('quotes a value with a newline', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('handles an empty string', () => {
    expect(csvField('')).toBe('');
  });
});

describe('toCsv', () => {
  it('joins fields with commas and rows with CRLF', () => {
    expect(
      toCsv([
        ['Student', 'Status', 'Reason'],
        ['Fatima', 'complete', ''],
        ['Bilal, A.', 'overridden', 'attended "live"'],
      ]),
    ).toBe(
      'Student,Status,Reason\r\n' +
        'Fatima,complete,\r\n' +
        '"Bilal, A.",overridden,"attended ""live"""',
    );
  });

  it('serialises an empty sheet to an empty string', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('csvFilename', () => {
  it('keeps ordinary punctuation and the extension', () => {
    expect(csvFilename('Hikam Foundations - Session 3 — Patience progress.csv')).toBe(
      'Hikam Foundations - Session 3 — Patience progress.csv',
    );
  });
  it('replaces what a file system refuses — a slash asked the phone for a subdirectory', () => {
    expect(csvFilename('Fiqh/Usul - attendance by session.csv')).toBe('Fiqh-Usul - attendance by session.csv');
    expect(csvFilename('Class: A - x?y*z.csv')).toBe('Class- A - x-y-z.csv');
  });
  it('has a name even when handed nothing usable', () => {
    expect(csvFilename('   .csv')).toBe('export.csv');
  });
});
