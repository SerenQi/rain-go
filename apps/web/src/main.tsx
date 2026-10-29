import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { Welcome } from "./components/Welcome";
import { Connect } from "./pages/Connect";
import { MatchPage } from "./pages/Match";
import { Sandbox } from "./pages/Sandbox";
import { Lobby } from "./pages/Lobby";
import { Arena } from "./pages/Arena";
import { parseRoute, useRoute } from "./router";
import "./styles.css";

function App() {
  const route = useRoute();
  // Asked once per page load. Someone opening a game link already knows where they are going.
  const [welcome, setWelcome] = useState(() => parseRoute(location.pathname).name !== "game");
  return (
    <Shell route={route}>
      {welcome && <Welcome onClose={() => setWelcome(false)} />}
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
