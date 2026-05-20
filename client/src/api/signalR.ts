import * as signalR from '@microsoft/signalr'

const HUB_URL =
  (import.meta.env.VITE_API_URL ?? '') + '/hubs/trading'

export function createTradingConnection() {
  return new signalR.HubConnectionBuilder()
    .withUrl(HUB_URL)
    .withAutomaticReconnect()
    .build()
}
