// Unknown URLs never reach the (app) group, so without this they get Next's
// unbranded 404. Same page as the app's own.
export { default } from './(app)/not-found';
