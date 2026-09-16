# Obnova službenog Gradle 8.4 wrappera; provjera SHA-256 prije korištenja.
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $PSScriptRoot 'gradle\wrapper'
$Jar = Join-Path $Dir 'gradle-wrapper.jar'
$Temp = Join-Path $Dir 'gradle-wrapper.download'
try {
    Invoke-WebRequest 'https://raw.githubusercontent.com/gradle/gradle/v8.4.0/gradle/wrapper/gradle-wrapper.jar' -OutFile $Temp -TimeoutSec 60 -UseBasicParsing
    # -UseBasicParsing izbjegava upozorenje o IE parsing engine-u (nema Interneta Explorera na
    # novijim Windows instalacijama, pa Invoke-WebRequest bez ovoga traži potvrdu korisnika).
    # .Content zna doći kao byte[] umjesto string (zavisi od Content-Type odgovora servera) —
    # eksplicitna konverzija sprječava "System.Byte does not contain a method named 'Trim'".
    $RawContent = (Invoke-WebRequest 'https://services.gradle.org/distributions/gradle-8.4-wrapper.jar.sha256' -TimeoutSec 30 -UseBasicParsing).Content
    if ($RawContent -is [byte[]]) { $RawContent = [System.Text.Encoding]::UTF8.GetString($RawContent) }
    $Expected = $RawContent.Trim().ToLower()
    if ($Expected -notmatch '^[0-9a-f]{64}$') { throw 'Neispravan službeni checksum' }
    if ((Get-FileHash $Temp -Algorithm SHA256).Hash.ToLower() -ne $Expected) { throw 'Wrapper checksum se ne podudara' }
    Move-Item -Force $Temp $Jar
} finally { if (Test-Path $Temp) { Remove-Item $Temp } }
