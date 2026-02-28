import { Elysia } from "elysia";
import basketballConfig from "../../../sports/basketball.json";
import footballConfig from "../../../sports/football.json";
import cricketConfig from "../../../sports/cricket.json";

export const sportsRoute = new Elysia({ prefix: "/api/sports" })
  .get("/", () => ({
    sports: [
      {
        name: "basketball",
        emoji: "🏀",
        events: basketballConfig.events || [],
        description: "Basketball analysis (jump shots, layups, dunks, free throws, 3-pt)"
      },
      {
        name: "football",
        emoji: "⚽",
        events: footballConfig.events || [],
        description: "Football (soccer) analysis (strikes, headers, volleys, penalties)"
      },
      {
        name: "cricket",
        emoji: "🏏",
        events: cricketConfig.events || [],
        description: "Cricket analysis (drives, pulls, sweeps, cuts, hooks)"
      }
    ]
  }));
