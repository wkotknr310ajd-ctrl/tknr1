Attribute VB_Name = "modRollback"
Option Explicit

' 「ロールバック」シートの承認済み一覧を履歴シートから再構築する。
Public Sub RefreshApprovedList()
    Dim hist As Worksheet, rb As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Set rb = ThisWorkbook.Sheets("ロールバック")

    Const HEADER_ROW As Long = 11
    Const FIRST_DATA_ROW As Long = 12

    Dim lastClear As Long
    lastClear = rb.Cells(rb.Rows.Count, 1).End(xlUp).Row
    If lastClear >= FIRST_DATA_ROW Then
        rb.Range(rb.Cells(FIRST_DATA_ROW, 1), rb.Cells(lastClear, 7)).ClearContents
    End If

    Dim lastHistRow As Long
    lastHistRow = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row

    Dim outRow As Long
    outRow = FIRST_DATA_ROW
    Dim r As Long
    For r = 2 To lastHistRow
        If CStr(hist.Cells(r, 8).Value) = "承認" Then
            rb.Cells(outRow, 1).Value = hist.Cells(r, 1).Value
            rb.Cells(outRow, 2).Value = hist.Cells(r, 3).Value
            rb.Cells(outRow, 3).Value = hist.Cells(r, 4).Value
            rb.Cells(outRow, 3).NumberFormat = "yyyy/mm/dd"
            rb.Cells(outRow, 4).Value = hist.Cells(r, 5).Value
            rb.Cells(outRow, 5).Value = hist.Cells(r, 6).Value
            rb.Cells(outRow, 6).Value = hist.Cells(r, 9).Value
            rb.Cells(outRow, 7).Value = hist.Cells(r, 10).Value
            rb.Cells(outRow, 7).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            outRow = outRow + 1
        End If
    Next r

    Dim lastRow As Long
    lastRow = rb.Cells(rb.Rows.Count, 1).End(xlUp).Row
    With rb.Range("B3").Validation
        .Delete
        If lastRow >= FIRST_DATA_ROW Then
            .Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
                 Formula1:="=ロールバック!$A$" & FIRST_DATA_ROW & ":$A$" & lastRow
        End If
    End With
End Sub

' 承認済み変更を1件取り消し、シフト表を変更前の値に戻す。
' 取り消し自体も新たな履歴として必ず記録される(誰が・いつ・何を取り消したか)。
Public Sub RollbackChange()
    Dim rb As Worksheet
    Set rb = ThisWorkbook.Sheets("ロールバック")

    Dim targetId As String, apprName As String, pwd As String
    targetId = Trim$(CStr(rb.Range("B3").Value))
    apprName = Trim$(CStr(rb.Range("B4").Value))
    pwd = CStr(rb.Range("B5").Value)

    If targetId = "" Or apprName = "" Then
        MsgBox "対象の申請IDと承認者氏名を入力してください。", vbExclamation
        Exit Sub
    End If

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim staffRow As Long
    staffRow = FindStaffMasterRow(apprName)
    If staffRow = 0 Then
        MsgBox apprName & " は職員マスタに登録されていません。", vbCritical
        Exit Sub
    End If
    If InStr(CStr(masterWs.Cells(staffRow, 2).Value), "承認者") = 0 Then
        MsgBox apprName & " には承認権限がありません(取り消しにも承認権限が必要です)。", vbCritical
        Exit Sub
    End If

    Dim salt As String, storedHash As String
    salt = CStr(masterWs.Cells(staffRow, 3).Value)
    storedHash = CStr(masterWs.Cells(staffRow, 4).Value)
    If Not VerifyPassword(pwd, salt, storedHash) Then
        MsgBox "パスワードが正しくありません。", vbCritical
        rb.Range("B5").Value = ""
        Exit Sub
    End If

    Dim hist As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Dim histRow As Long
    histRow = FindHistoryRowById(targetId)
    If histRow = 0 Then
        MsgBox "対象の申請が見つかりません。", vbCritical
        Exit Sub
    End If
    If CStr(hist.Cells(histRow, 8).Value) <> "承認" Then
        MsgBox "承認済みの申請のみ取り消せます。", vbExclamation
        Exit Sub
    End If

    Dim staffName As String, targetDate As Date, beforeShift As String, afterShift As String
    staffName = CStr(hist.Cells(histRow, 3).Value)
    targetDate = CDate(hist.Cells(histRow, 4).Value)
    beforeShift = CStr(hist.Cells(histRow, 5).Value)
    afterShift = CStr(hist.Cells(histRow, 6).Value)

    If MsgBox("申請ID " & targetId & " (" & staffName & " / " & Format(targetDate, "yyyy/mm/dd") & ") の変更を取り消し、" & vbCrLf & _
              "シフト表を「" & beforeShift & "」に戻します。よろしいですか?", vbYesNo + vbQuestion) = vbNo Then
        Exit Sub
    End If

    Dim shiftRow As Long, shiftCol As Long
    shiftRow = FindShiftStaffRow(staffName)
    shiftCol = FindShiftDayColumn(Day(targetDate))
    If shiftRow = 0 Or shiftCol = 0 Then
        MsgBox "シフト表の対象セルが見つかりません。", vbCritical
        Exit Sub
    End If

    Dim shiftWs As Worksheet
    Set shiftWs = ThisWorkbook.Sheets("シフト表")
    Dim actualCurrent As String
    actualCurrent = CStr(shiftWs.Cells(shiftRow, shiftCol).Value)
    If actualCurrent <> afterShift Then
        If MsgBox("シフト表の現在値(" & actualCurrent & ")が承認時の反映値(" & afterShift & ")と異なります。" & vbCrLf & _
                  "このまま「" & beforeShift & "」に戻してよろしいですか?", vbYesNo + vbExclamation) = vbNo Then
            Exit Sub
        End If
    End If

    shiftWs.Cells(shiftRow, shiftCol).Value = beforeShift

    hist.Cells(histRow, 8).Value = "取消(ロールバック)"

    Dim newId As String
    newId = NextRequestId()
    AppendHistoryRow newId, Now, apprName, targetDate, afterShift, beforeShift, _
                      "ロールバックによる取消(元申請: " & targetId & ")", "取消完了", apprName, Now, targetId

    MsgBox "取り消しました。シフト表を元の状態に戻しました。", vbInformation

    rb.Range("B3").Value = ""
    rb.Range("B5").Value = ""

    RefreshPendingList
    RefreshApprovedList
    ThisWorkbook.Save
End Sub
