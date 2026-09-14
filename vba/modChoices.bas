Attribute VB_Name = "modChoices"
Option Explicit

' 対象日・時刻をドロップダウンから選べるようにするための一覧を用意する。
' 一覧は「選択肢」という非表示シートに用意し、名前付き範囲(DateList/TimeList)
' 経由で各シートのセルから参照する(別シートを直接参照するとExcelの制限で
' 実行時エラー1004になるため、職員名の一覧と同じ仕組みを使う)。
'
' 日付一覧は「設定」シートの対象年月をもとに毎回自動生成されるので、
' 対象月を変更したときは Alt+F8 から SetupChoiceLists を実行し直すか、
' ファイルを閉じて開き直せば(Workbook_Openで自動実行される)最新化される。
Public Sub SetupChoiceLists()
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("選択肢")
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        ws.Name = "選択肢"
    End If

    ws.Cells.Clear

    Dim q As String
    q = Chr(34) ' ダブルクォート1文字(Excel数式内の空文字列 "" を組み立てるのに使う)

    Dim i As Long
    For i = 1 To 31
        ws.Cells(i, 1).Formula = "=IF(" & i & "<=DAY(EOMONTH(設定!$B$1,0)),設定!$B$1+" & (i - 1) & "," & q & q & ")"
        ws.Cells(i, 1).NumberFormat = "m/d(aaa)"
    Next i

    For i = 1 To 48
        ws.Cells(i, 2).Formula = "=TIME(INT((" & i & "-1)/2),MOD(" & i & "-1,2)*30,0)"
        ws.Cells(i, 2).NumberFormat = "hh:mm"
    Next i

    ws.Visible = xlSheetVeryHidden

    ThisWorkbook.Names.Add Name:="DateList", RefersTo:="=選択肢!$A$1:$A$31"
    ThisWorkbook.Names.Add Name:="TimeList", RefersTo:="=選択肢!$B$1:$B$48"

    SetDateValidation ThisWorkbook.Sheets("申請").Range("B5")
    SetDateValidation ThisWorkbook.Sheets("交換申請").Range("B7")
    SetDateValidation ThisWorkbook.Sheets("交換申請").Range("B12")
    SetDateValidation ThisWorkbook.Sheets("有給申請").Range("B5")
    SetDateValidation ThisWorkbook.Sheets("有給申請").Range("B6")
    SetDateValidation ThisWorkbook.Sheets("超過勤務申請").Range("B5")
    SetTimeValidation ThisWorkbook.Sheets("超過勤務申請").Range("B6")
    SetTimeValidation ThisWorkbook.Sheets("超過勤務申請").Range("B7")
End Sub

' 一覧から選ぶだけでなく、直接入力もできるように警告のみ(停止しない)にしている。
Private Sub SetDateValidation(ByVal targetCell As Range)
    Dim ws As Worksheet
    Set ws = targetCell.Worksheet
    Dim wasProtected As Boolean
    wasProtected = UnprotectIfNeeded(ws)
    With targetCell.Validation
        .Delete
        .Add Type:=xlValidateList, AlertStyle:=xlValidAlertInformation, Formula1:="=DateList"
    End With
    ReprotectIfNeeded ws, wasProtected
End Sub

Private Sub SetTimeValidation(ByVal targetCell As Range)
    Dim ws As Worksheet
    Set ws = targetCell.Worksheet
    Dim wasProtected As Boolean
    wasProtected = UnprotectIfNeeded(ws)
    With targetCell.Validation
        .Delete
        .Add Type:=xlValidateList, AlertStyle:=xlValidAlertInformation, Formula1:="=TimeList"
    End With
    ReprotectIfNeeded ws, wasProtected
End Sub
