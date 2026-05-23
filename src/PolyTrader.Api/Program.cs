using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.SignalR;
using PolyTrader.Api.Hubs;
using PolyTrader.Api.Logging;
using PolyTrader.Api.Middleware;
using PolyTrader.Api.HostedServices;
using PolyTrader.Api.Services;
using PolyTrader.Core.Abstractions;
using PolyTrader.Api;
using PolyTrader.Infrastructure;
using Serilog;

EnvFileLoader.LoadFromAncestors(Directory.GetCurrentDirectory());

var builder = WebApplication.CreateBuilder(args);
var liveLogBroadcaster = SerilogBootstrap.Configure(builder);

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSignalR();
builder.Services.AddSingleton<SignalRTradingEventPublisher>();
builder.Services.AddSingleton<TelegramTradingEventPublisher>();
builder.Services.AddSingleton<ITradingEventPublisher>(sp =>
    new CompositeTradingEventPublisher(
    [
        sp.GetRequiredService<SignalRTradingEventPublisher>(),
        sp.GetRequiredService<TelegramTradingEventPublisher>(),
    ]));
builder.Services.AddSingleton<ILogFileClearService, SerilogLogFileClearService>();
builder.Services.AddHostedService<TelegramBotHostedService>();
builder.Services.Configure<HostOptions>(o =>
{
    // Optional Telegram must not stop the trading engine on network blips.
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore;
});
builder.Services.AddPolyTraderInfrastructure(builder.Configuration);

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
    {
        var origins = new List<string>
        {
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        };
        var extra = builder.Configuration["CORS_ORIGINS"]
            ?? builder.Configuration["PolyTrader:CorsOrigins"];
        if (!string.IsNullOrWhiteSpace(extra))
        {
            foreach (var o in extra.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!origins.Contains(o, StringComparer.OrdinalIgnoreCase))
                {
                    origins.Add(o);
                }
            }
        }

        policy.WithOrigins(origins.ToArray())
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

try
{
    Log.Information("PolyTrader API starting (environment={Environment})", builder.Environment.EnvironmentName);

    var app = builder.Build();

    app.UseSerilogRequestLogging(options =>
    {
        options.GetLevel = (ctx, _, ex) =>
        {
            if (ex != null)
            {
                return Serilog.Events.LogEventLevel.Error;
            }

            if (ctx.Response.StatusCode >= 500)
            {
                return Serilog.Events.LogEventLevel.Error;
            }

            if (ctx.Response.StatusCode >= 400)
            {
                return Serilog.Events.LogEventLevel.Warning;
            }

            return Serilog.Events.LogEventLevel.Information;
        };
    });

    await app.Services.InitializeDatabaseAsync();

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI();
    }

    app.UseCors("ReactApp");
    app.UseMiddleware<ApiTokenMiddleware>();
    app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
    app.MapControllers();
    app.MapHub<TradingHub>(TradingHub.HubPath);

    var liveLogs = app.Services.GetRequiredService<LiveLogBroadcaster>();
    liveLogs.Attach(
        app.Services.GetRequiredService<IHubContext<TradingHub>>(),
        app.Lifetime.ApplicationStopping);
    app.Lifetime.ApplicationStopped.Register(() => _ = liveLogs.DisposeAsync());

    Log.Information("PolyTrader API listening");
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "PolyTrader API terminated unexpectedly");
    throw;
}
finally
{
    Log.CloseAndFlush();
}
