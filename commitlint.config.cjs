const allowedTypes = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test'
];

module.exports = {
  ignores: [
    (message = '') => message.startsWith('Merge '),
    (message = '') => message.startsWith('Revert "')
  ],
  rules: {
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', allowedTypes],
    'subject-empty': [2, 'never'],
    'scope-case': [2, 'always', 'kebab-case'],
    'header-max-length': [2, 'always', 100]
  }
};
