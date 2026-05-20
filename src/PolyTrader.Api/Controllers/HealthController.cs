using Microsoft.AspNetCore.Mvc;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class HealthController : ControllerBase
{
    private readonly IConnectivityService _connectivity;

    public HealthController(IConnectivityService connectivity) => _connectivity = connectivity;

    [HttpGet]
    public ActionResult<object> Get() => Ok(new { status = "ok" });

    [HttpGet("connectivity")]
    public ActionResult<ConnectivityStatusDto> Connectivity() => Ok(_connectivity.GetStatus());
}
