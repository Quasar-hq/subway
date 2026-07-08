$ErrorActionPreference = 'Stop'

$serviceKey = '26e4b09801e0b038eeb4574cdf75e63d809becbda505250e744fd5d0314d9422'
$baseUrl = 'https://apis.data.go.kr/1613000/SubwayInfo/GetSubwaySttnAcctoSchdulList'

function Get-Times {
  param(
    [string]$StationId,
    [string]$Direction,
    [string]$DayTypeCode
  )

  $builder = [System.UriBuilder]::new($baseUrl)
  $builder.Query = "serviceKey=$([uri]::EscapeDataString($serviceKey))&pageNo=1&numOfRows=500&_type=json&subwayStationId=$([uri]::EscapeDataString($StationId))&dailyTypeCode=$DayTypeCode&upDownTypeCode=$Direction"
  $json = Invoke-WebRequest -Uri $builder.Uri -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json
  @(
    $json.response.body.items.item |
      ForEach-Object { $_.depTime } |
      ForEach-Object {
        if ($_ -and $_.Length -ge 4) {
          '{0}:{1}' -f $_.Substring(0, 2), $_.Substring(2, 2)
        }
      } |
      Sort-Object -Unique
  )
}

function Get-ScheduleForDayType {
  param(
    [string]$DayTypeCode
  )

  [ordered]@{
    meta = [ordered]@{
      title = 'last train data'
      updatedAt = (Get-Date).ToString('o')
      dayTypeCode = $DayTypeCode
    }
    routes = @(
      [ordered]@{
        legs = @(
          [ordered]@{
            departures = Get-Times -StationId 'MTRKR1P153' -Direction 'D' -DayTypeCode $DayTypeCode
          }
          [ordered]@{
            departures = Get-Times -StationId 'MTRKR4443' -Direction 'U' -DayTypeCode $DayTypeCode
          }
        )
      }
      [ordered]@{
        legs = @(
          [ordered]@{
            departures = Get-Times -StationId 'MTRS14420' -Direction 'D' -DayTypeCode $DayTypeCode
          }
          [ordered]@{
            departures = Get-Times -StationId 'MTRKR4443' -Direction 'U' -DayTypeCode $DayTypeCode
          }
        )
      }
    )
  }
}

$data = [ordered]@{
  meta = [ordered]@{
    title = 'last train data'
    updatedAt = (Get-Date).ToString('o')
    dayTypes = [ordered]@{
      weekday = '01'
      saturday = '02'
      sunday = '03'
    }
  }
  schedules = [ordered]@{
    weekday = Get-ScheduleForDayType -DayTypeCode '01'
    saturday = Get-ScheduleForDayType -DayTypeCode '02'
    sunday = Get-ScheduleForDayType -DayTypeCode '03'
  }
}

$json = $data | ConvertTo-Json -Depth 10
Set-Content -Encoding UTF8 -Path 'schedule-data.js' -Value "window.REAL_TIMETABLE = $json;"
Write-Host "schedule-data.js updated for weekday/weekend schedules"
