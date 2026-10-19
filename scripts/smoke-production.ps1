[CmdletBinding()]
param(
    [string]$ApiBase = "https://fai-rfare.vercel.app/api"
)

$ErrorActionPreference = "Stop"
$ApiBase = $ApiBase.TrimEnd('/')
$script:Failures = 0

function Get-ElapsedMilliseconds {
    param([System.Diagnostics.Stopwatch]$Stopwatch)
    return [int]$Stopwatch.ElapsedMilliseconds
}

function Invoke-JsonEndpoint {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [object]$Body
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $request = @{
            Method      = $Method
            Uri         = $Uri
            Headers     = @{ Accept = "application/json" }
            UseBasicParsing = $true
        }
        if ($null -ne $Body) {
            $request.ContentType = "application/json"
            $request.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
        }

        $response = Invoke-WebRequest @request
        $stopwatch.Stop()
        $json = $null
        try { $json = $response.Content | ConvertFrom-Json } catch { }
        return [pscustomobject]@{
            Status       = [int]$response.StatusCode
            ElapsedMs    = Get-ElapsedMilliseconds $stopwatch
            Json         = $json
            JsonValid    = $null -ne $json
            NetworkError = $null
        }
    }
    catch {
        $stopwatch.Stop()
        $status = $null
        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch { }
        }
        return [pscustomobject]@{
            Status       = $status
            ElapsedMs    = Get-ElapsedMilliseconds $stopwatch
            Json         = $null
            JsonValid    = $false
            NetworkError = $_.Exception.Message
        }
    }
}

function Write-TestResult {
    param(
        [string]$Name,
        [bool]$Passed,
        [Nullable[int]]$Status,
        [int]$ElapsedMs,
        [string]$Diagnostic
    )

    $statusText = if ($null -eq $Status) { "N/A" } else { [string]$Status }
    $resultText = if ($Passed) { "PASS" } else { "FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }
    if (-not $Passed) { $script:Failures++ }
    Write-Host ("[{0}] {1} | HTTP {2} | {3} ms | {4}" -f $resultText, $Name, $statusText, $ElapsedMs, $Diagnostic) -ForegroundColor $color
}

function Test-ApiEnvelope {
    param([object]$Json)
    return ($null -ne $Json -and $Json.success -eq $true -and $null -ne $Json.data)
}

function Test-Coordinate {
    param([object]$Value, [double]$Minimum, [double]$Maximum)
    $number = 0.0
    return ([double]::TryParse(([string]$Value), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -and $number -ge $Minimum -and $number -le $Maximum)
}

function Get-PropertyValue {
    param([object]$Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-SearchText {
    param([object]$Object)
    $parts = @()
    foreach ($name in @("description", "mainText", "secondaryText", "address")) {
        $value = Get-PropertyValue $Object $name
        if ($null -ne $value) { $parts += [string]$value }
    }
    return ($parts -join " ")
}

Write-Host "Fair Fare production smoke test" -ForegroundColor Cyan
Write-Host "API base: $ApiBase"
Write-Host "Public, non-destructive endpoints only. Response bodies are not printed."

# Contract: GET /api/health/ returns { success: true, data: { application, database } }.
$health = Invoke-JsonEndpoint -Method GET -Uri "$ApiBase/health/"
$healthPass = ($health.Status -eq 200 -and $health.JsonValid -and (Test-ApiEnvelope $health.Json) -and $health.Json.data.application -eq "alive")
$healthDiagnostic = if ($health.NetworkError) { "Network error: request did not receive an HTTP response" } elseif (-not $health.JsonValid) { "Response was not valid JSON" } elseif (-not $healthPass) { "Unexpected health response schema" } else { "application=alive; database status present" }
Write-TestResult "GET /health/" $healthPass $health.Status $health.ElapsedMs $healthDiagnostic

# Contract: GET /api/maps/autocomplete requires input and sessionToken.
$sessionToken = [guid]::NewGuid().ToString()
$landmarks = @(
    @{ Name = "Emporium Mall"; Query = "Emporium Mall Lahore" },
    @{ Name = "Packages Mall"; Query = "Packages Mall Lahore" },
    @{ Name = "Liberty Market"; Query = "Liberty Market Lahore" }
)

$autocompleteResults = @{}
foreach ($landmark in $landmarks) {
    $query = [uri]::EscapeDataString($landmark.Query)
    $token = [uri]::EscapeDataString($sessionToken)
    $uri = "$ApiBase/maps/autocomplete?input=$query&sessionToken=$token"
    $result = Invoke-JsonEndpoint -Method GET -Uri $uri
    $autocompleteResults[$landmark.Name] = $result

    $items = if ($result.JsonValid -and (Test-ApiEnvelope $result.Json) -and $result.Json.data -is [System.Array]) { @($result.Json.data) } else { @() }
    $validCoordinates = @($items | Where-Object { (Test-Coordinate (Get-PropertyValue $_ "lat") -90 90) -and (Test-Coordinate (Get-PropertyValue $_ "lng") -180 180) }).Count
    $relevant = @($items | Where-Object {
        $text = (Get-SearchText $_).ToLowerInvariant()
        $text.Contains("lahore") -or $text.Contains($landmark.Name.ToLowerInvariant())
    }).Count
    $pass = ($result.Status -eq 200 -and $result.JsonValid -and (Test-ApiEnvelope $result.Json) -and $items.Count -gt 0 -and $validCoordinates -gt 0 -and $relevant -gt 0)
    $diagnostic = if ($result.NetworkError) { "Network error: request did not receive an HTTP response" } elseif (-not $result.JsonValid) { "Response was not valid JSON" } elseif ($items.Count -eq 0) { "No results returned" } elseif ($validCoordinates -eq 0) { "No results contained valid coordinates" } elseif ($relevant -eq 0) { "Results were not recognizably Lahore-relevant" } else { "$($items.Count) result(s); $validCoordinates with coordinates; Lahore relevance confirmed" }
    Write-TestResult "GET /maps/autocomplete [$($landmark.Name)]" $pass $result.Status $result.ElapsedMs $diagnostic
}

# Contract: GET /api/maps/reverse-geocode requires numeric lat/lng and returns
# { success: true, data: { name, address, lat, lng } }.
$reverseUri = "$ApiBase/maps/reverse-geocode?lat=31.5100&lng=74.3436"
$reverse = Invoke-JsonEndpoint -Method GET -Uri $reverseUri
$reverseData = if ($reverse.JsonValid -and (Test-ApiEnvelope $reverse.Json)) { $reverse.Json.data } else { $null }
$reverseAddress = [string](Get-PropertyValue $reverseData "address")
$reversePass = ($reverse.Status -eq 200 -and $reverse.JsonValid -and (Test-ApiEnvelope $reverse.Json) -and -not [string]::IsNullOrWhiteSpace($reverseAddress) -and (Test-Coordinate (Get-PropertyValue $reverseData "lat") -90 90) -and (Test-Coordinate (Get-PropertyValue $reverseData "lng") -180 180))
$reverseDiagnostic = if ($reverse.NetworkError) { "Network error: request did not receive an HTTP response" } elseif (-not $reverse.JsonValid) { "Response was not valid JSON" } elseif (-not $reversePass) { "Missing address or valid coordinates" } else { "Plausible address and coordinates returned; address redacted from output" }
Write-TestResult "GET /maps/reverse-geocode" $reversePass $reverse.Status $reverse.ElapsedMs $reverseDiagnostic

# Contract: POST /api/maps/route accepts origin, destination, vehicleType and
# returns positive distance/duration plus encodedPolyline/polylineCoordinates.
$routeBody = @{
    origin      = @{ lat = 31.4677; lng = 74.2657 } # Emporium Mall
    destination = @{ lat = 31.5100; lng = 74.3436 } # Liberty Market
    vehicleType = "car"
}
$route = Invoke-JsonEndpoint -Method POST -Uri "$ApiBase/maps/route" -Body $routeBody
$routeData = if ($route.JsonValid -and (Test-ApiEnvelope $route.Json)) { $route.Json.data } else { $null }
$distanceMeters = [double](Get-PropertyValue $routeData "distanceMeters")
$durationSeconds = [double](Get-PropertyValue $routeData "durationSeconds")
$encodedPolyline = [string](Get-PropertyValue $routeData "encodedPolyline")
$polylineCoordinates = Get-PropertyValue $routeData "polylineCoordinates"
$routePass = ($route.Status -eq 200 -and $route.JsonValid -and (Test-ApiEnvelope $route.Json) -and $distanceMeters -gt 0 -and $durationSeconds -gt 0 -and -not [string]::IsNullOrWhiteSpace($encodedPolyline) -and @($polylineCoordinates).Count -ge 2)
$routeDiagnostic = if ($route.NetworkError) { "Network error: request did not receive an HTTP response" } elseif (-not $route.JsonValid) { "Response was not valid JSON" } elseif (-not $routePass) { "Missing positive distance/duration or usable route geometry" } else { "Positive distance/duration; encoded polyline and geometry present; units retained as meters/seconds" }
Write-TestResult "POST /maps/route" $routePass $route.Status $route.ElapsedMs $routeDiagnostic

Write-Host ""
if ($script:Failures -gt 0) {
    Write-Host "Smoke test FAILED: $script:Failures check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host "Smoke test PASSED: all public checks passed." -ForegroundColor Green
exit 0
