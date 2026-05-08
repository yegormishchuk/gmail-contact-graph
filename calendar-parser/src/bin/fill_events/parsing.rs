/// Take an iterator of raw lines and return logical lines with continuations folded in.
pub fn unfold_lines<I: IntoIterator<Item = String>>(lines: I) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        if (line.starts_with(' ') || line.starts_with('\t')) && !out.is_empty() {
            let last = out.last_mut().unwrap();
            last.push_str(&line[1..]);
        } else {
            out.push(line);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfold_joins_continuation_lines() {
        let input = vec![
            "DESCRIPTION:hello".to_string(),
            " world".to_string(),
            "\tagain".to_string(),
            "SUMMARY:next".to_string(),
        ];
        let out = unfold_lines(input);
        assert_eq!(out, vec!["DESCRIPTION:helloworldagain", "SUMMARY:next"]);
    }

    #[test]
    fn unfold_handles_empty_input() {
        let out = unfold_lines(Vec::<String>::new());
        assert!(out.is_empty());
    }

    #[test]
    fn unfold_ignores_leading_continuation_with_no_predecessor() {
        let input = vec![" orphan".to_string(), "REAL:x".to_string()];
        let out = unfold_lines(input);
        assert_eq!(out, vec![" orphan", "REAL:x"]);
    }
}
