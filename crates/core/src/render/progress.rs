//! Parses FFmpeg's stderr progress lines.

/// Extracts the encoded position from a `time=HH:MM:SS.ms` progress line.
pub fn parse_time(line: &str) -> Option<f64> {
    let index = line.find("time=")?;
    let rest = &line[index + 5..];
    let value = rest.split_whitespace().next()?;
    parse_timecode(value)
}

fn parse_timecode(value: &str) -> Option<f64> {
    let mut parts = value.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_line() {
        let line =
            "frame=  120 fps= 30 q=28.0 size=    512kB time=00:00:04.00 bitrate=1048.6kbits/s";
        let seconds = parse_time(line).unwrap();
        assert!((seconds - 4.0).abs() < 1e-6);
    }

    #[test]
    fn parses_hours() {
        assert_eq!(parse_time("time=01:02:03.50").unwrap(), 3723.5);
    }

    #[test]
    fn ignores_lines_without_time() {
        assert!(parse_time("Press [q] to stop").is_none());
    }

    #[test]
    fn ignores_malformed_timecode() {
        assert!(parse_time("time=N/A").is_none());
    }
}
