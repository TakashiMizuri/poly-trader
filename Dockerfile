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
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:5088
ENV POLYTRADER_LOG_DIR=/app/logs
EXPOSE 5088
VOLUME ["/app/data", "/app/logs"]
ENTRYPOINT ["dotnet", "PolyTrader.Api.dll"]
