FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY PolyTrader.sln ./
COPY src/PolyTrader.Core/PolyTrader.Core.csproj src/PolyTrader.Core/
COPY src/PolyTrader.Infrastructure/PolyTrader.Infrastructure.csproj src/PolyTrader.Infrastructure/
COPY src/PolyTrader.Api/PolyTrader.Api.csproj src/PolyTrader.Api/
RUN dotnet restore src/PolyTrader.Api/PolyTrader.Api.csproj
COPY src/ src/
RUN dotnet publish src/PolyTrader.Api/PolyTrader.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:5088
ENV POLYTRADER_LOG_DIR=/app/logs
EXPOSE 5088
VOLUME ["/app/data", "/app/logs"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://127.0.0.1:5088/health || exit 1
ENTRYPOINT ["dotnet", "PolyTrader.Api.dll"]
