import m from "mithril"
import { MainPage } from "./pages/main"
import { StreamPage } from "./pages/stream"
import { CorrelationPage } from "./pages/correlation"
import { CategoryPage } from "./pages/category"


m.route(document.body, "/", {
  "/": MainPage,
  "/stream/:stream_name": StreamPage,
  "/correlation/:correlation_id": CorrelationPage,
  "/category/:category": CategoryPage,
})
