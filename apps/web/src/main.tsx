import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { Connect } from "./pages/Connect";
import { MatchPage } from "./pages/Match";
import { Sandbox } from "./pages/Sandbox";
import { Lobby } from "./pages/Lobby";
import { Arena } from "./pages/Arena";
import { useRoute } from "./router";
import "./styles.css";

function App() {
  const route = useRoute();
  return (
    <Shell route={route} wide={route.name === "game" || route.name === "sandbox"}>
      {route.name === "game" ? (
        <MatchPage key={route.id} id={route.id} />
      ) : route.name === "sandbox" ? (
        <Sandbox key={route.kind} kind={route.kind} />
      ) : route.name === "connect" ? (
        <Connect />
      ) : route.name === "arena" ? (
        <Arena />
      ) : (
        <Lobby />
      )}
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
