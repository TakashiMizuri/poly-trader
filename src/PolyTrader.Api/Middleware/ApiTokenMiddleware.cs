using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Api.Middleware;

public sealed class ApiTokenMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string? _token;
    private readonly ILogger<ApiTokenMiddleware> _logger;

    public ApiTokenMiddleware(
        RequestDelegate next,
        IOptions<PolyTraderOptions> options,
        ILogger<ApiTokenMiddleware> logger)
    {
        _next = next;
        _token = options.Value.WebApiToken;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (string.IsNullOrWhiteSpace(_token))
        {
            await _next(context);
            return;
        }

        if (context.Request.Path.StartsWithSegments("/health"))
        {
            await _next(context);
            return;
        }

        if (IsAuthorized(context, _token))
        {
            await _next(context);
            return;
        }

        _logger.LogWarning(
            "Unauthorized API request {Method} {Path}",
            context.Request.Method,
            context.Request.Path);
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
    }

    private static bool IsAuthorized(HttpContext context, string expectedToken)
    {
        var auth = context.Request.Headers.Authorization.ToString();
        if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            && auth["Bearer ".Length..].Trim() == expectedToken)
        {
            return true;
        }

        var queryToken = context.Request.Query["access_token"].ToString();
        if (!string.IsNullOrEmpty(queryToken) && queryToken == expectedToken)
        {
            return true;
        }

        return false;
    }
}
