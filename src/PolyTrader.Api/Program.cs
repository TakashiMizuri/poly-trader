using System.Text.Json;
using System.Text.Json.Serialization;
using PolyTrader.Api.Hubs;
using PolyTrader.Api.Middleware;
using PolyTrader.Api.Services;
using PolyTrader.Core.Abstractions;
using PolyTrader.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSignalR();
builder.Services.AddSingleton<ITradingEventPublisher, SignalRTradingEventPublisher>();
builder.Services.AddPolyTraderInfrastructure(builder.Configuration);

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

await app.Services.InitializeDatabaseAsync();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("ReactApp");
app.UseMiddleware<ApiTokenMiddleware>();
app.MapControllers();
app.MapHub<TradingHub>(TradingHub.HubPath);

app.Run();
