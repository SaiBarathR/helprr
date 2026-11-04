// An answer that is not plain JSON: a status other than 200, or text. Tagged, so no JSON
// value can be mistaken for one.
export const RAW = Symbol('raw');
export const raw = (status, body, type = 'application/json') => ({ [RAW]: true, status, body, type });
