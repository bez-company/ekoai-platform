// all-cases.js: os casos escritos um a um (cases.js) mais a matriz de cenários (scenarios.js).
import { CASES } from './cases.js';
import { SCENARIOS } from './scenarios.js';

export const ALL_CASES = [...CASES, ...SCENARIOS];
