import App from "./App.svelte";
import { mount } from "svelte";
import { loadConfig } from "./lib/config.svelte";
import "./app.css";

loadConfig().then(() => {
  mount(App, { target: document.getElementById("app")! });
});
