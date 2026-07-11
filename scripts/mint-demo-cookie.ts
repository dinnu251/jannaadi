import { mintSessionCookie } from "./lib/session";
mintSessionCookie({ role: "admin", sub: "demo-admin-recording" }).then((c) => console.log(c));
