using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Api.Middleware;

public sealed class ApiTokenMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string? _token;

    public ApiTokenMiddleware(RequestDelegate next, IOptions<PolyTraderOptions> options)
    {
        _next = next;
        _token = options.Value.WebApiToken;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (string.IsNullOrWhiteSpace(_token)
            || context.Request.Path.StartsWithSegments("/health")
            || context.Request.Path.StartsWithSegments("/hubs"))
        {
            await _next(context);
            return;
        }

        var auth = context.Request.Headers.Authorization.ToString();
        if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            && auth["Bearer ".Length..].Trim() == _token)
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
    }
}
