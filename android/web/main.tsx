// Starting point of the Android app's screens. It shows the same Lecturely
// page as the website, without needing a web server.
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { Route } from "../../src/routes/index";

const Page = Route.options.component as React.ComponentType;
createRoot(document.getElementById("app")!).render(<Page />);
