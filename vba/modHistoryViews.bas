Attribute VB_Name = "modHistoryViews"
Option Explicit

' 履歴シートを種別(勤務変更/勤務交換/有給/残業)で絞り込んだビューを、
' 「勤務変更履歴」「有給履歴」「残業履歴」の3シートに自動反映する。
' 勤務変更履歴には「勤務変更」(単独)と「勤務交換」の両方をまとめて表示し、
' 承認・却下・ロールバックもすべて同じ一覧の中でステータス列から確認できる。
Public Sub RefreshAllCategoryHistory()
    EnsureHistoryViewSheets

    RefreshKindHistory Array("勤務変更", "勤務交換"), "勤務変更履歴"
    RefreshKindHistory Array("有給"), "有給履歴"
    RefreshKindHistory Array("残業"), "残業履歴"
End Sub

Private Sub RefreshKindHistory(ByVal kinds As Variant, ByVal targetSheetName As String)
    Dim hist As Worksheet, dst As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Set dst = ThisWorkbook.Sheets(targetSheetName)

    Dim wasProtected As Boolean
    wasProtected = UnprotectIfNeeded(dst)

    Dim lastClear As Long
    lastClear = dst.Cells(dst.Rows.Count, 1).End(xlUp).Row
    If lastClear >= 2 Then
        dst.Range(dst.Cells(2, 1), dst.Cells(lastClear, 12)).ClearContents
    End If

    Dim lastHistRow As Long
    lastHistRow = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row

    Dim outRow As Long
    outRow = 2
    Dim r As Long, c As Long
    For r = 2 To lastHistRow
        If MatchesKind(CStr(hist.Cells(r, 13).Value), kinds) Then
            For c = 1 To 12
                dst.Cells(outRow, c).Value = hist.Cells(r, c).Value
            Next c
            dst.Cells(outRow, 2).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            dst.Cells(outRow, 5).NumberFormat = "yyyy/mm/dd"
            dst.Cells(outRow, 11).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            outRow = outRow + 1
        End If
    Next r

    ReprotectIfNeeded dst, wasProtected
End Sub

Private Function MatchesKind(ByVal kind As String, ByVal kinds As Variant) As Boolean
    Dim k As Variant
    For Each k In kinds
        If kind = CStr(k) Then
            MatchesKind = True
            Exit Function
        End If
    Next k
    MatchesKind = False
End Function

' 古いバージョンのファイルにはビュー用シートがまだ存在しないため、
' なければ自動的に作成する。
Private Sub EnsureHistoryViewSheets()
    Dim headers As Variant
    headers = Array("申請ID", "申請日時", "申請者", "対象者", "対象日", "変更前", "変更後", _
                     "変更理由", "ステータス", "承認者", "承認/処理日時", "元申請ID(ロールバック用)")

    Dim viewName As Variant
    For Each viewName In Array("勤務変更履歴", "有給履歴", "残業履歴")
        Dim ws As Worksheet
        Set ws = Nothing
        On Error Resume Next
        Set ws = ThisWorkbook.Sheets(CStr(viewName))
        On Error GoTo 0
        If ws Is Nothing Then
            Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
            ws.Name = CStr(viewName)
            Dim i As Long
            For i = 0 To UBound(headers)
                ws.Cells(1, i + 1).Value = headers(i)
            Next i
            ws.Rows(1).Font.Bold = True
        End If
    Next viewName
End Sub
