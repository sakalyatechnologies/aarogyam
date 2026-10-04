import { buildFetch, type Env } from "../shared/api-proxy.js";

export default {
  fetch(request: Request, env: Env) {
    return buildFetch(env)(request);
  },
};
