import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply the saved theme before first render so dark mode doesn't flash light
if (localStorage.getItem("locallink_theme") === "dark") {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(<App />);
